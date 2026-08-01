# Symbiotic Membrane — Interface de l'Ombilic

Anatomical UI layer on top of Fluxa water + lifecycle. Not software chrome: a living membrane.

## Three pillars

### 1. Chorion (field)

Abyssal bioluminescence — black tinted teal. The heightmap water field is the tissue of the membrane. No pages, tabs, or fixed nav.

### 2. Anima (IA heart)

Soft orb at attention center. Pulses with breath/energy. Colors:

| State | Color |
| --- | --- |
| Balance / react | Cyan |
| Focus / high energy | Amber–gold |
| Dream / high Ia | Ethereal violet |
| Critical stress | Dark red |

### 3. Filament (umbilicus)

Reactive light ribbon from cursor → Anima. Curves under tension; vibrates with stress. Materializes proxemics.

## Implementation note

This pass composites Anima + Filament in `RENDER_FRAG` over the Chorion water field. Full Gray-Scott Anima skin and slime-mold organites remain deferred.
