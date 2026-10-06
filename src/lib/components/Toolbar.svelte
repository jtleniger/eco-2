<script lang="ts">
  import { SPEEDS } from '../config.ts';
  import type { Engine } from '../engine.ts';
  import { ui } from '../ui.svelte.ts';

  let { engine }: { engine: Engine } = $props();
</script>

<div class="toolbar">
  <button
    data-testid="start"
    disabled={ui.status === 'running'}
    onclick={() => engine.start()}>Start</button
  >
  <button
    data-testid="pause"
    disabled={ui.status === 'paused'}
    onclick={() => engine.pause()}>Pause</button
  >
  <button data-testid="reset" onclick={() => engine.reset()}>Reset</button>

  {#each SPEEDS as s (s)}
    <button
      data-testid="speed-{s}"
      aria-pressed={ui.speed === s}
      onclick={() => engine.setSpeed(s)}>{s}x</button
    >
  {/each}

  <button data-testid="menu" aria-pressed={ui.menuOpen} onclick={() => (ui.menuOpen = !ui.menuOpen)}
    >Menu</button
  >

  <span class="spacer"></span>
  <span class="stat">status <span data-testid="status">{ui.status}</span></span>
  <span class="stat">tick <span data-testid="tick">{ui.tick}</span></span>
  <span class="stat">season <span data-testid="season">{ui.season}</span></span>
</div>
