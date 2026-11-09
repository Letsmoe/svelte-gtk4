<script lang="ts">
  // A tile the host carries. The first drop is taken and moves it; the second
  // is refused and changes nothing, so the host has only the answer to go by.

  let point = $state({ x: 10, y: 10 })
  let drops = $state(0)
  let carried = $state('none')

  function drop(event: { detail: { carried: boolean } }): void {
    drops += 1
    carried = String(event.detail.carried)
    if (drops === 1) {
      point = { x: 200, y: 100 }
    }
  }
</script>

<gtkoverlay>
  <gtkbox width={400} height={300}>
    <gtklabel class="carried">{carried}</gtklabel>
  </gtkbox>
  <gtkpressable
    overlay
    class="tile"
    carry="tiles"
    carried-by="tiles"
    glide={120}
    halign="start"
    valign="start"
    margin-start={point.x}
    margin-top={point.y}
    width={40}
    height={40}
    ondragend={drop}
  ></gtkpressable>
  <gtkbox overlay class="band" banded-by="tiles" halign="start" valign="start"></gtkbox>
</gtkoverlay>
