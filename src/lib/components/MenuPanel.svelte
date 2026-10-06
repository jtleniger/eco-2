<script lang="ts">
  import { H, W } from '../config.ts';
  import { BIOMES, FOODS } from '../palette.ts';
  import { ui } from '../ui.svelte.ts';

  const pct = (v: number | undefined) => `${((v ?? 0) * 100).toFixed(1)}%`;

  /**
   * Scroll a freshly opened species detail to the top of the species list, so its header (name
   * and Back button) is in view wherever in the list the row was; the detail names the species
   * it belongs to. Only the list scrolls; the panel and the World section below it do not move.
   */
  function reveal(node: HTMLElement) {
    const box = node.parentElement;
    if (!box) return;
    box.scrollTop += node.getBoundingClientRect().top - box.getBoundingClientRect().top;
  }
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

    <h3>Species</h3>
    <div class="species-list" data-testid="species-list">
      {#each ui.species as sp (sp.id)}
        <button
          class="row creature"
          class:extinct={sp.extinctTick >= 0}
          data-testid="species-row"
          onclick={() => (ui.selectedSpecies = sp.id)}
        >
          <i class="swatch" style="background:{sp.hex}"></i>
          <div class="col">
            <span class="name">{sp.name}</span>
            <span class="sub">{sp.dietClass}{sp.prey ? ` · ${sp.prey}` : ''}</span>
            {#if sp.extinctTick >= 0}
              <span class="sub">extinct @ {sp.extinctTick}</span>
            {/if}
          </div>
          <span class="val">{sp.live}</span>
        </button>
        {#if sp.id === ui.selectedSpecies}
          <div class="detail" data-testid="species-detail" use:reveal>
            <div class="row">
              <i class="swatch" style="background:{sp.hex}"></i>
              <span class="name">{sp.name}</span>
              <button data-testid="species-back" onclick={() => (ui.selectedSpecies = null)}>Back</button>
            </div>
            <div class="row">
              <span class="name">population</span>
              <span class="val">{sp.live} live · {sp.peak} peak · {sp.maxPop} cap</span>
            </div>
            <div class="row">
              <span class="name">founded</span>
              <span class="val">tick {sp.founderTick} · gen {sp.generation}</span>
            </div>
            <div class="row"><span class="name">parent</span><span class="val">{sp.parentName ?? '—'}</span></div>
            <div class="row"><span class="name">class</span><span class="val">{sp.dietClass}</span></div>
            <div class="row"><span class="name">diet</span><span class="val">{sp.diet}</span></div>
            <div class="row"><span class="name">habitat</span><span class="val">{sp.habitat}</span></div>
            <div class="row"><span class="name">prey</span><span class="val">{sp.prey || '—'}</span></div>
            <div class="row"><span class="name">size</span><span class="val">{sp.traits.size.toFixed(2)}</span></div>
            <div class="row"><span class="name">carnivory</span><span class="val">{(sp.traits.carnivory * 100).toFixed(0)}%</span></div>
            <div class="row"><span class="name">vision</span><span class="val">{sp.traits.vision}</span></div>
            <div class="row"><span class="name">speed</span><span class="val">{sp.traits.speed}</span></div>
            <div class="row">
              <span class="name">move chance</span>
              <span class="val">{(sp.traits.moveChance * 100).toFixed(0)}%</span>
            </div>
            <div class="row">
              <span class="name">metabolism</span>
              <span class="val">{sp.traits.metabolism.toFixed(2)}</span>
            </div>
            <div class="row">
              <span class="name">max energy</span>
              <span class="val">{sp.traits.maxEnergy.toFixed(0)}</span>
            </div>
            <div class="row">
              <span class="name">repro energy</span>
              <span class="val">{sp.traits.reproEnergy.toFixed(0)}</span>
            </div>
            <div class="row"><span class="name">max age</span><span class="val">{sp.traits.maxAge}</span></div>
            <div class="row">
              <span class="name">eat gain</span>
              <span class="val">{sp.traits.eatGain.toFixed(0)}</span>
            </div>
            <div class="row">
              <span class="name">start energy</span>
              <span class="val">{sp.traits.startEnergy.toFixed(0)}</span>
            </div>
            <div class="row">
              <span class="name">survival</span>
              <span class="val">{sp.traits.tempMin.toFixed(2)}–{sp.traits.tempMax.toFixed(2)}</span>
            </div>
            <div class="row">
              <span class="name">comfort</span>
              <span class="val">{sp.traits.comfortMin.toFixed(2)}–{sp.traits.comfortMax.toFixed(2)}</span>
            </div>
          </div>
        {/if}
      {/each}
    </div>

    <h3>World</h3>
    <div class="row"><span class="name">size</span><span class="val">{W} × {H}</span></div>
    <div class="row"><span class="name">seed</span><span class="val" data-testid="seed">{ui.seed}</span></div>
    <div class="row"><span class="name">tick</span><span class="val">{ui.tick}</span></div>
    <div class="row"><span class="name">season</span><span class="val" data-testid="season-label">{ui.season}</span></div>
    <div class="row"><span class="name">temperature</span><span class="val">{ui.meanTemp.toFixed(2)} ({(ui.seasonOffset >= 0 ? '+' : '')}{ui.seasonOffset.toFixed(2)})</span></div>
    <div class="row"><span class="name">status</span><span class="val">{ui.status}</span></div>
    <div class="row"><span class="name">speed</span><span class="val">{ui.speed}x</span></div>
  </aside>
{/if}
