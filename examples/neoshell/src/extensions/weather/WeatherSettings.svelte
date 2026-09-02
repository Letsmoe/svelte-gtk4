<script lang="ts">
  import { untrack } from 'svelte'

  // The card's own settings, per widget instance. Two weather widgets on one
  // desktop are two places, so this writes weather.cards.<id> rather than the
  // shared section — a card that has never been edited keeps following the
  // section's defaults.
  //
  // Typing into a card on the background layer only works because the desktop's
  // view-tree node asks for keyboard: ondemand; a layer that takes no focus
  // cannot be typed into at all.

  let {
    place,
    imperial,
    onsave,
    oncancel,
  }: {
    place: string
    imperial: boolean
    onsave: (place: string, imperial: boolean) => void
    oncancel: () => void
  } = $props()

  // Seeded once, on purpose: the form is mounted when the card flips to its
  // settings face, and a poll landing mid-edit must not overwrite what is being
  // typed.
  let draftPlace = $state(untrack(() => place))
  let draftImperial = $state(untrack(() => imperial))

  function submit(): void {
    onsave(draftPlace.trim(), draftImperial)
  }

  function readPlace(event: { target: { widget: { get_text(): string } } }): void {
    draftPlace = event.target.widget.get_text()
  }

  function unitLabel(isImperial: boolean): string {
    if (isImperial) {
      return '°F'
    }
    return '°C'
  }
</script>

<gtkbox class="card-settings" orientation="vertical" spacing={8} vexpand>
  <gtkbox orientation="vertical" spacing={2}>
    <gtklabel class="card-settings-label" halign="start">Location</gtklabel>
    <gtkentry
      class="card-settings-entry"
      placeholder="City"
      text={draftPlace}
      onchanged={readPlace}
      onactivate={submit}
    ></gtkentry>
  </gtkbox>

  <gtkbox orientation="horizontal" spacing={8}>
    <gtklabel class="card-settings-label" hexpand halign="start">Units</gtklabel>
    <gtkbutton
      class="card-settings-button"
      frame={false}
      onclicked={() => (draftImperial = !draftImperial)}
    >
      {unitLabel(draftImperial)}
    </gtkbutton>
  </gtkbox>

  <gtkbox orientation="horizontal" spacing={8} homogeneous valign="end" vexpand>
    <gtkbutton class="card-settings-button" frame={false} onclicked={oncancel}>Cancel</gtkbutton>
    <gtkbutton class="card-settings-button primary" frame={false} onclicked={submit}>
      Done
    </gtkbutton>
  </gtkbox>
</gtkbox>
