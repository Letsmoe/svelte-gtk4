// Some GTK properties take another widget rather than a value — a stack
// switcher has to be handed the stack it drives. Markup has no way to pass a
// widget reference, so a widget names itself with `id` and anything that needs
// it asks for that name.
//
// Document order does not decide construction order here: a switcher can be
// created before the stack it points at, so a request that cannot be answered
// yet is parked until the name registers.

const widgets = new Map<string, any>();
const waiting = new Map<string, ((widget: any) => void)[]>();

export function register(id: string, widget: any): void {
  if (id === "") {
    return;
  }
  widgets.set(id, widget);
  const pending = waiting.get(id);
  if (pending === undefined) {
    return;
  }
  waiting.delete(id);
  for (const resolve of pending) {
    resolve(widget);
  }
}

export function unregister(id: string): void {
  widgets.delete(id);
}

/** Calls back immediately if the name is known, otherwise once it is. */
export function resolve(id: string, use: (widget: any) => void): void {
  if (id === "") {
    return;
  }
  const widget = widgets.get(id);
  if (widget !== undefined) {
    use(widget);
    return;
  }
  const pending = waiting.get(id);
  if (pending === undefined) {
    waiting.set(id, [use]);
    return;
  }
  pending.push(use);
}
