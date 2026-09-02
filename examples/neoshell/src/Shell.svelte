<script lang="ts">
  import { subscribeTo } from './lib/bus'
  import type { Bus } from './host/bus'
  import type { ViewRegistry } from './host/plugins/views'
  import {
    anchorOf,
    exclusiveZoneOf,
    keyOf,
    keyboardOf,
    layerOf,
    marginOf,
    namespaceOf,
    nodesOf,
    recordOf,
    resolve,
    sizeOf,
  } from './tree'
  import type { TreeNode } from './tree'
  import ViewNode from './ViewNode.svelte'

  // The root of the widget tree: one gtk4-layer-shell window per top-level
  // view-tree node. The tree arrives on the retained "views" topic, so a config
  // edit adds, moves or removes a window without anything here being reloaded.

  let { bus, registry }: { bus: Bus; registry: ViewRegistry } = $props()

  let nodes = $state<TreeNode[]>([])
  // The registry is a plain object outside Svelte's reactivity. Every
  // registration bumps this, and the nodes re-resolve their type against it —
  // that is what makes a view appear when its extension finishes mounting.
  let generation = $state(0)

  $effect(() =>
    subscribeTo(bus, 'views', (message) => {
      nodes = nodesOf(message.data)
    }),
  )

  $effect(() =>
    registry.onChange(() => {
      generation += 1
    }),
  )

  // A window whose type has not been registered yet would be an empty surface
  // the compositor still maps, so the whole window waits for the component.
  function isReady(node: TreeNode, current: number): boolean {
    return resolve(registry, node.type, current) !== undefined
  }
</script>

{#each nodes as node, index (keyOf(node, index))}
  {@const args = recordOf(node.args)}
  {#if isReady(node, generation)}
    <gtkwindow
      namespace={namespaceOf(node)}
      layer={layerOf(args)}
      anchor={anchorOf(args)}
      keyboard-mode={keyboardOf(args)}
      exclusive-zone={exclusiveZoneOf(args)}
      gap={marginOf(args)}
      decorated={false}
      default-width={sizeOf(args, 'width')}
      default-height={sizeOf(args, 'height')}
    >
      <!-- The window takes exactly one child and a view renders zero or more
           widgets, so this box is what it is always given. -->
      <gtkbox orientation="vertical">
        <ViewNode {node} {bus} {registry} {generation} />
      </gtkbox>
    </gtkwindow>
  {/if}
{/each}
