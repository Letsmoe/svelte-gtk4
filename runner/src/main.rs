//! Runs one svelte-gtk4 client bundle in QuickJS. The client talks to its host
//! in frames, a 32-bit little-endian length and that many bytes of JSON: the
//! host's arrive on stdin and go to `__receive`, the client's leave through
//! `__runner.send` on stdout. Console output goes to stderr.
//!
//! Everything here assumes the bundle is hostile. It gets a memory limit, a
//! stack limit and a time limit per turn; a turn that runs over is stopped and
//! the runner exits, so the host can replace it. The runner never reads or
//! writes anything but its three standard streams and the bundle.
//!
//!     svelte-gtk4-runner <bundle.js> [--memory-mb N] [--turn-ms N]
//!
//! Exit codes: 0 the host closed stdin, 2 the bundle failed to load, 3 a turn
//! ran over its time, 4 the memory limit was hit, 5 the host went away.

use std::cell::{Cell, RefCell};
use std::io::{Read, Write};
use std::rc::Rc;
use std::time::{Duration, Instant};

use rquickjs::{CaughtError, Coerced, Context, Ctx, Function, Object, Runtime, function::Rest};

const PRELUDE: &str = include_str!("prelude.js");
const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
const STACK_BYTES: usize = 4 * 1024 * 1024;
// Above this share of its limit a client is treated as out of memory, even if
// it caught the allocation failure itself.
const MEMORY_CEILING: f64 = 0.95;
// Loading the bundle builds the whole runtime, so it gets more than a turn.
const LOAD_TURNS: u32 = 10;

struct Options {
    bundle: String,
    memory_mb: usize,
    turn_ms: u64,
}

fn main() {
    let options = match parse_options() {
        Ok(options) => options,
        Err(message) => {
            eprintln!("svelte-gtk4-runner: {message}");
            std::process::exit(2);
        }
    };
    lower_priority();
    let runner = Runner::new(&options);
    runner.load(&options.bundle);
    runner.serve();
}

fn parse_options() -> Result<Options, String> {
    let mut arguments = std::env::args().skip(1);
    let mut options = Options { bundle: String::new(), memory_mb: 64, turn_ms: 500 };
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--memory-mb" => options.memory_mb = number_after(&mut arguments, "--memory-mb")?,
            "--turn-ms" => options.turn_ms = number_after(&mut arguments, "--turn-ms")? as u64,
            _ => options.bundle = argument,
        }
    }
    if options.bundle.is_empty() {
        return Err("usage: svelte-gtk4-runner <bundle.js> [--memory-mb N] [--turn-ms N]".into());
    }
    Ok(options)
}

fn number_after(arguments: &mut impl Iterator<Item = String>, flag: &str) -> Result<usize, String> {
    let value = arguments.next().ok_or(format!("{flag} needs a number"))?;
    value.parse().map_err(|_| format!("{flag} needs a number, not {value:?}"))
}

/// A client is never more urgent than the shell drawing it.
fn lower_priority() {
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, 0, 10);
    }
}

struct Runner {
    runtime: Runtime,
    context: Context,
    memory_limit: usize,
    started: Instant,
    turn: Duration,
    deadline: Rc<Cell<Option<Instant>>>,
    interrupted: Rc<Cell<bool>>,
    input: RefCell<Vec<u8>>,
}

impl Runner {
    fn new(options: &Options) -> Self {
        let runtime = Runtime::new().expect("quickjs runtime");
        let memory_limit = options.memory_mb * 1024 * 1024;
        runtime.set_memory_limit(memory_limit);
        runtime.set_max_stack_size(STACK_BYTES);
        let deadline: Rc<Cell<Option<Instant>>> = Rc::new(Cell::new(None));
        let interrupted = Rc::new(Cell::new(false));
        let watched = deadline.clone();
        let flag = interrupted.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || {
            let Some(due) = watched.get() else {
                return false;
            };
            if Instant::now() < due {
                return false;
            }
            flag.set(true);
            true
        })));
        let context = Context::full(&runtime).expect("quickjs context");
        let runner = Self {
            runtime,
            context,
            memory_limit,
            started: Instant::now(),
            turn: Duration::from_millis(options.turn_ms),
            deadline,
            interrupted,
            input: RefCell::new(Vec::new()),
        };
        runner.install_globals();
        runner
    }

    fn install_globals(&self) {
        let started = self.started;
        self.context.with(|ctx| {
            let runner = Object::new(ctx.clone()).expect("runner object");
            let send = Function::new(ctx.clone(), |text: String| write_frame(text.as_bytes()))
                .expect("send function");
            runner.set("send", send).expect("set send");
            let now = Function::new(ctx.clone(), move || started.elapsed().as_secs_f64() * 1000.0)
                .expect("now function");
            runner.set("now", now).expect("set now");
            ctx.globals().set("__runner", runner).expect("set __runner");
            ctx.globals().set("console", console(&ctx)).expect("set console");
        });
    }

    fn load(&self, bundle: &str) {
        let source = match std::fs::read_to_string(bundle) {
            Ok(source) => source,
            Err(error) => {
                eprintln!("svelte-gtk4-runner: cannot read {bundle}: {error}");
                std::process::exit(2);
            }
        };
        self.start_turn(LOAD_TURNS);
        let loaded = self.context.with(|ctx| {
            ctx.eval::<(), _>(PRELUDE).map_err(|error| caught(&ctx, error))?;
            ctx.eval::<(), _>(source).map_err(|error| caught(&ctx, error))
        });
        self.end_turn();
        if let Err(message) = loaded {
            self.fail_on_limits(&message);
            eprintln!("svelte-gtk4-runner: the bundle failed to load: {message}");
            std::process::exit(2);
        }
        self.drain();
    }

    /// Runs timers and answers the host until the host closes stdin.
    fn serve(&self) {
        loop {
            let wait = self.pump();
            if !wait_for_input(wait) {
                continue;
            }
            if !self.read_input() {
                std::process::exit(0);
            }
            while let Some(frame) = self.next_frame() {
                self.deliver(frame);
            }
        }
    }

    /// Runs due timers; answers how long until the next one, or None for no timer.
    fn pump(&self) -> Option<Duration> {
        self.start_turn(1);
        let next = self.context.with(|ctx| {
            let pump: Function = ctx.globals().get("__pump").map_err(|error| caught(&ctx, error))?;
            pump.call::<_, f64>(()).map_err(|error| caught(&ctx, error))
        });
        self.end_turn();
        self.drain();
        match next {
            Ok(milliseconds) if milliseconds >= 0.0 => Some(Duration::from_secs_f64(milliseconds / 1000.0)),
            Ok(_) => None,
            Err(message) => {
                self.fail_on_limits(&message);
                eprintln!("svelte-gtk4-runner: timers: {message}");
                None
            }
        }
    }

    fn deliver(&self, frame: String) {
        self.start_turn(1);
        let delivered = self.context.with(|ctx| {
            let receive: Function = ctx.globals().get("__receive").map_err(|error| caught(&ctx, error))?;
            receive.call::<_, ()>((frame,)).map_err(|error| caught(&ctx, error))
        });
        self.end_turn();
        if let Err(message) = delivered {
            self.fail_on_limits(&message);
            eprintln!("svelte-gtk4-runner: {message}");
        }
        self.drain();
    }

    /// Runs queued promise jobs until there are none; Svelte schedules its work as microtasks.
    fn drain(&self) {
        self.start_turn(1);
        loop {
            match self.runtime.execute_pending_job() {
                Ok(true) => {}
                Ok(false) => break,
                Err(job) => {
                    let message = job.0.with(|ctx| caught(&ctx, rquickjs::Error::Exception));
                    self.fail_on_limits(&message);
                    eprintln!("svelte-gtk4-runner: a microtask failed: {message}");
                }
            }
        }
        self.end_turn();
    }

    fn start_turn(&self, turns: u32) {
        self.deadline.set(Some(Instant::now() + self.turn * turns));
    }

    fn end_turn(&self) {
        self.deadline.set(None);
        let used = self.runtime.memory_usage().malloc_size as f64;
        if used > self.memory_limit as f64 * MEMORY_CEILING {
            eprintln!("svelte-gtk4-runner: the memory limit was hit");
            std::process::exit(4);
        }
    }

    /// A turn stopped for running too long, or memory exhausted, leaves the client's state
    /// half-updated; the only safe thing is to stop and let the host start a fresh one.
    fn fail_on_limits(&self, message: &str) {
        if self.interrupted.get() {
            eprintln!("svelte-gtk4-runner: a turn ran longer than {} ms", self.turn.as_millis());
            std::process::exit(3);
        }
        if message.contains("out of memory") {
            eprintln!("svelte-gtk4-runner: the memory limit was hit");
            std::process::exit(4);
        }
    }

    /// Reads what stdin has; false when the host closed it.
    fn read_input(&self) -> bool {
        let mut chunk = [0u8; 64 * 1024];
        match std::io::stdin().lock().read(&mut chunk) {
            Ok(0) => false,
            Ok(count) => {
                self.input.borrow_mut().extend_from_slice(&chunk[..count]);
                true
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => true,
            Err(_) => false,
        }
    }

    fn next_frame(&self) -> Option<String> {
        let mut input = self.input.borrow_mut();
        if input.len() < 4 {
            return None;
        }
        let length = u32::from_le_bytes([input[0], input[1], input[2], input[3]]) as usize;
        if length > MAX_FRAME_BYTES {
            eprintln!("svelte-gtk4-runner: the host sent a frame of {length} bytes");
            std::process::exit(5);
        }
        if input.len() < 4 + length {
            return None;
        }
        let frame: Vec<u8> = input.drain(..4 + length).skip(4).collect();
        Some(String::from_utf8_lossy(&frame).into_owned())
    }
}

/// Waits until stdin has something or `wait` passes; true when there is input.
fn wait_for_input(wait: Option<Duration>) -> bool {
    let timeout = match wait {
        Some(duration) => duration.as_millis().min(i32::MAX as u128) as i32,
        None => -1,
    };
    let mut descriptor = libc::pollfd { fd: 0, events: libc::POLLIN, revents: 0 };
    let ready = unsafe { libc::poll(&mut descriptor, 1, timeout) };
    ready > 0
}

fn write_frame(bytes: &[u8]) {
    let mut out = std::io::stdout().lock();
    let length = (bytes.len() as u32).to_le_bytes();
    let written = out.write_all(&length).and_then(|_| out.write_all(bytes)).and_then(|_| out.flush());
    if written.is_err() {
        std::process::exit(5);
    }
}

fn console<'js>(ctx: &Ctx<'js>) -> Object<'js> {
    let console = Object::new(ctx.clone()).expect("console object");
    for name in ["log", "info", "warn", "error", "debug"] {
        let print = Function::new(ctx.clone(), move |arguments: Rest<Coerced<String>>| {
            let words: Vec<String> = arguments.0.into_iter().map(|word| word.0).collect();
            eprintln!("[{name}] {}", words.join(" "));
        })
        .expect("console function");
        console.set(name, print).expect("set console");
    }
    console
}

fn caught(ctx: &Ctx<'_>, error: rquickjs::Error) -> String {
    match CaughtError::from_error(ctx, error) {
        CaughtError::Exception(exception) => {
            let message = exception.message().unwrap_or_default();
            match exception.stack() {
                Some(stack) => format!("{message}\n{stack}"),
                None => message,
            }
        }
        CaughtError::Value(value) => value
            .get::<Coerced<String>>()
            .map(|text| text.0)
            .unwrap_or_else(|_| "a thrown value".into()),
        CaughtError::Error(error) => error.to_string(),
    }
}
