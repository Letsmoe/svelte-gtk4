<script lang="ts">
  // A tile the host carries. The first drop is taken and moves it; the second
  // is refused and changes nothing, so the host has only the answer to go by.
  // The first drop also moves a neighbour no drag carries, which glides there.

  let point = $state({ x: 10, y: 10 })
  let neighbour = $state({ x: 300, y: 10 })
  let drops = $state(0)
  let carried = $state('none')

  function drop(event: { detail: { carried: boolean } }): void {
    drops += 1
    carried = String(event.detail.carried)
    if (drops === 1) {
      point = { x: 200, y: 100 }
      neighbour = { x: 300, y: 200 }
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
  <gtkbox
    overlay
    class="neighbour"
    glide={200}
    halign="start"
    valign="start"
    margin-start={neighbour.x}
    margin-top={neighbour.y}
    width={40}
    height={40}
  ></gtkbox>
  <gtkbox overlay class="band" banded-by="tiles" halign="start" valign="start"></gtkbox>
</gtkoverlay>
