<script lang="ts">
  import { onMount } from 'svelte';
  import { Engine } from './lib/engine.ts';
  import Toolbar from './lib/components/Toolbar.svelte';
  import MenuPanel from './lib/components/MenuPanel.svelte';

  let canvas: HTMLCanvasElement;
  let stage: HTMLDivElement;
  let engine = $state<Engine | null>(null);

  onMount(() => {
    engine = new Engine(canvas);
    engine.renderer.fit(stage.clientWidth, stage.clientHeight);
    const ro = new ResizeObserver(() => engine!.renderer.fit(stage.clientWidth, stage.clientHeight));
    ro.observe(stage);
    return () => ro.disconnect();
  });
</script>

<div class="app">
  {#if engine}<Toolbar {engine} />{/if}
  <div class="stage" bind:this={stage}><canvas bind:this={canvas}></canvas></div>
  <MenuPanel />
</div>
