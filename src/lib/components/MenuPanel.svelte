<script lang="ts">
  import { H, W } from '../config.ts';
  import { BIOMES, FOODS } from '../palette.ts';
  import { ui } from '../ui.svelte.ts';

  const pct = (v: number | undefined) => `${((v ?? 0) * 100).toFixed(1)}%`;
</script>

{#if ui.menuOpen}
  <aside class="menu-panel" data-testid="menu-panel">
    <header class="menu-head">
      <h2>Legend</h2>
      <button data-testid="menu-close" onclick={() => (ui.menuOpen = false)}>Close</button>
    </header>

    <h3>Biomes</h3>
    {#each BIOMES as b, i (b.name)}
      <div class="row" data-testid="biome-row">
        <i class="swatch" style="background:{b.hex}"></i>
        <span class="name">{b.name}</span>
        <span class="val">{pct(ui.biomeShare[i])}</span>
      </div>
    {/each}

    <h3>Food</h3>
    {#each FOODS as f, i (f.name)}
      <div class="row food" data-testid="food-row">
        <i class="swatch" style="background:{f.hex}"></i>
        <div class="col">
          <span class="name">{f.name}</span>
          <span class="sub">on {f.biomes.map((b) => BIOMES[b].name).join(', ')}</span>
        </div>
        <span class="val">{ui.counts[i] ?? 0} · {pct(ui.coverage[i])}</span>
      </div>
    {/each}

    <h3>World</h3>
    <div class="row"><span class="name">size</span><span class="val">{W} × {H}</span></div>
    <div class="row"><span class="name">seed</span><span class="val" data-testid="seed">{ui.seed}</span></div>
    <div class="row"><span class="name">tick</span><span class="val">{ui.tick}</span></div>
    <div class="row"><span class="name">status</span><span class="val">{ui.status}</span></div>
    <div class="row"><span class="name">speed</span><span class="val">{ui.speed}x</span></div>
  </aside>
{/if}
