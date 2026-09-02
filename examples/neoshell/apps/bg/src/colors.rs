//! Shared store for the bar-strip gradient stops.
//!
//! The Wayland thread computes the stops whenever the wallpaper changes and
//! publishes them here; socket-handler threads read the latest set and stream
//! updates to subscribed clients (the Go core).

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

type Stops = Vec<[u8; 3]>;

pub struct ColorHub {
    inner: Mutex<Inner>,
}

struct Inner {
    current: Option<Stops>,
    subscribers: Vec<Sender<Stops>>,
}

impl ColorHub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner {
                current: None,
                subscribers: Vec::new(),
            }),
        })
    }

    /// The latest stops, if a wallpaper has been rendered yet.
    pub fn current(&self) -> Option<Stops> {
        self.inner.lock().expect("color hub poisoned").current.clone()
    }

    /// Register a subscriber. The returned receiver yields the current stops
    /// immediately (when present) and every later update.
    pub fn subscribe(&self) -> Receiver<Stops> {
        let (sender, receiver) = channel();
        let mut inner = self.inner.lock().expect("color hub poisoned");
        if let Some(current) = inner.current.clone() {
            let _ = sender.send(current);
        }
        inner.subscribers.push(sender);
        receiver
    }

    /// Store the new stops and push them to every live subscriber, dropping any
    /// whose receiver has hung up.
    pub fn publish(&self, stops: Stops) {
        let mut inner = self.inner.lock().expect("color hub poisoned");
        inner.current = Some(stops.clone());
        inner.subscribers.retain(|sender| sender.send(stops.clone()).is_ok());
    }
}
