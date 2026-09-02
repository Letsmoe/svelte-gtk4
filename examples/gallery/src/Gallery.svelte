<script lang="ts">
  // One of every tag in the registry. Building it is the smoke test: a wrong
  // method name or a GTK version mismatch crashes here rather than quietly
  // rendering nothing.
  let count = $state(0);
  let volume = $state(40);
  let query = $state("");
  let checked = $state(true);
  let expanded = $state(true);
  let size = $state(1);

  const draw = (_area: unknown, cr: any, width: number, height: number) => {
    cr.setSourceRGBA(0.4, 0.6, 1, 1);
    cr.arc(width / 2, height / 2, Math.min(width, height) / 2 - 2, 0, Math.PI * 2);
    cr.fill();
  };
</script>

<gtkwindow id="gallery" title="svelte-gtk4 gallery" default-width={880} default-height={620}>
  <gtkheaderbar place="titlebar" controls>
    <gtkstackswitcher place="title" stack="pages"></gtkstackswitcher>
    <gtkmenubutton place="end" icon="open-menu-symbolic">
      <gtkpopover place="popover">
        <gtkbox orientation="vertical" spacing={4} margin={8}>
          <gtklabel>A popover, held open by a menu button.</gtklabel>
          <gtkcolorbutton alpha></gtkcolorbutton>
          <gtkfontbutton font="Cantarell 11" preview></gtkfontbutton>
        </gtkbox>
      </gtkpopover>
    </gtkmenubutton>
    <gtkbutton place="start" icon="list-add-symbolic" onclicked={() => (count += 1)}></gtkbutton>
  </gtkheaderbar>

  <gtkbox orientation="vertical">
    <gtksearchbar search close-button capture="gallery">
      <gtksearchentry placeholder="Search" delay={200} text={query}
                      onsearch-changed={(e) => (query = e.target.widget.get_text())}></gtksearchentry>
    </gtksearchbar>

    <gtkstack id="pages" transition="slide-left-right" duration={180} vexpand>
      <!-- Buttons and controls -->
      <gtkscrolledwindow name="controls" title="Controls" vscroll="automatic">
        <gtkbox orientation="vertical" spacing={12} margin={16}>
          <gtkbox spacing={8}>
            <gtkbutton onclicked={() => (count += 1)}>Clicked {count} times</gtkbutton>
            <gtkbutton frame={false} icon="edit-copy-symbolic" tooltip="Frameless"></gtkbutton>
            <gtktogglebutton id="left" active>Left</gtktogglebutton>
            <gtktogglebutton group="left">Middle</gtktogglebutton>
            <gtktogglebutton group="left">Right</gtktogglebutton>
            <gtklinkbutton uri="https://gtk.org">gtk.org</gtklinkbutton>
          </gtkbox>

          <gtkbox spacing={8} valign="center">
            <gtkcheckbutton active={checked} label="A check button"
                            ontoggled={(e) => (checked = e.target.widget.get_active())}></gtkcheckbutton>
            <gtkcheckbutton id="one" label="One"></gtkcheckbutton>
            <gtkcheckbutton group="one" label="Two"></gtkcheckbutton>
            <gtkswitch active={checked}></gtkswitch>
            <gtkscalebutton icons={["audio-volume-low-symbolic", "audio-volume-high-symbolic"]}
                            min={0} max={100} value={volume}></gtkscalebutton>
          </gtkbox>

          <gtkscale min={0} max={100} step={1} value={volume} draw-value
                    onvalue-changed={(e) => (volume = e.target.widget.get_value())}></gtkscale>
          <gtkspinbutton min={0} max={10} step={1} value={size}></gtkspinbutton>
          <gtkdropdown items={["Small", "Medium", "Large"]} selected={size}></gtkdropdown>
          <gtkseparator></gtkseparator>
          <gtkprogressbar value={volume / 100} show-text text="{volume}%"></gtkprogressbar>
          <gtklevelbar min={0} max={100} value={volume}></gtklevelbar>
          <gtkspinner spinning></gtkspinner>
        </gtkbox>
      </gtkscrolledwindow>

      <!-- Text -->
      <gtkbox name="text" title="Text" orientation="vertical" spacing={12} margin={16}>
        <gtkentry placeholder="An entry" icon="edit-find-symbolic" text={query}
                  onchanged={(e) => (query = e.target.widget.get_text())}></gtkentry>
        <gtkpasswordentry placeholder="A password" peek></gtkpasswordentry>
        <gtkeditablelabel text="An editable label"></gtkeditablelabel>
        <gtktext placeholder="A bare text widget"></gtktext>
        <gtkscrolledwindow vexpand frame>
          <gtktextview monospace wrap="word-char" padding={8}>Multi-line text lives in a buffer.</gtktextview>
        </gtkscrolledwindow>
        <gtkinscription min-chars={20} xalign={0}>An inscription — sized by characters, not by its text.</gtkinscription>
      </gtkbox>

      <!-- Layout -->
      <gtkbox name="layout" title="Layout" orientation="vertical" spacing={12} margin={16}>
        <gtkcenterbox>
          <gtklabel place="start">start</gtklabel>
          <gtklabel place="center">center</gtklabel>
          <gtklabel place="end">end</gtklabel>
        </gtkcenterbox>

        <gtkgrid spacing={8}>
          <gtklabel col={0} row={0}>0,0</gtklabel>
          <gtklabel col={1} row={0}>1,0</gtklabel>
          <gtklabel col={0} row={1} colspan={2}>spans two</gtklabel>
        </gtkgrid>

        <gtkframe label="A frame">
          <gtkaspectframe ratio={3} obey-child={false}>
            <gtkoverlay>
              <gtkdrawingarea {draw} content-width={120} content-height={60}></gtkdrawingarea>
              <gtklabel overlay halign="end" valign="start" margin={4}>overlay</gtklabel>
            </gtkoverlay>
          </gtkaspectframe>
        </gtkframe>

        <gtkexpander label="An expander" expanded={expanded}>
          <gtkrevealer reveal={expanded} transition="slide-down">
            <gtkfixed height={40}>
              <gtklabel x={0} y={0}>fixed at 0,0</gtklabel>
              <gtklabel x={120} y={16}>and 120,16</gtklabel>
            </gtkfixed>
          </gtkrevealer>
        </gtkexpander>

        <gtkpaned position={200} vexpand>
          <gtkbox place="start" spacing={8}>
            <gtkstacksidebar stack="pages"></gtkstacksidebar>
            <gtklistbox selection="single" separators hexpand>
              <gtklabel>A list box row</gtklabel>
              <gtklabel>Another</gtklabel>
              <gtklabel>A third</gtklabel>
            </gtklistbox>
          </gtkbox>
          <gtkflowbox place="end" max-per-line={4} spacing={6}>
            <gtkbutton>one</gtkbutton>
            <gtkbutton>two</gtkbutton>
            <gtkbutton>three</gtkbutton>
            <gtkbutton>four</gtkbutton>
            <gtkbutton>five</gtkbutton>
          </gtkflowbox>
        </gtkpaned>
      </gtkbox>

      <!-- Display -->
      <gtkbox name="display" title="Display" orientation="vertical" spacing={12} margin={16}>
        <gtkbox spacing={8} valign="center">
          <gtkicon icon="face-smile-symbolic" size={32}></gtkicon>
          <gtkimage icon="weather-clear-symbolic" size={32}></gtkimage>
          <gtklabel tabular markup>Tabular <b>digits</b>: 00:00:00</gtklabel>
        </gtkbox>
        <gtkcalendar date="2026-09-02" week-numbers></gtkcalendar>

        <gtkbox spacing={8} height={80}>
          <!-- Both are empty without a file; they are here to be constructed. -->
          <gtkpicture fit="contain" alt="A picture" hexpand></gtkpicture>
          <gtkgraphicsoffload enabled>
            <gtkvideo autoplay loop hexpand></gtkvideo>
          </gtkgraphicsoffload>
          <gtkpressable onpress={() => (count += 1)} onhoverstart={() => {}}>
            <gtklabel>A pressable box</gtklabel>
          </gtkpressable>
        </gtkbox>

        <gtknotebook tab-position="top" vexpand>
          <gtklabel title="First">The first notebook page.</gtklabel>
          <gtkviewport title="Second">
            <gtkwindowhandle>
              <gtklabel>Drag here to move the window.</gtklabel>
            </gtkwindowhandle>
          </gtkviewport>
        </gtknotebook>
      </gtkbox>
    </gtkstack>

    <gtkactionbar revealed>
      <gtklabel place="start">{query === "" ? "No search" : `Searching for “${query}”`}</gtklabel>
      <gtkwindowcontrols place="end" side="end"></gtkwindowcontrols>
    </gtkactionbar>
  </gtkbox>
</gtkwindow>
