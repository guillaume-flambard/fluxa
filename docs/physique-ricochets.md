# Modélisation physique des ricochets et dynamique des fluides (Fluxa)

**Sujet** : Modélisation physique des ricochets et dynamique des fluides pour rendu WebGL  
**Statut** : Base de connaissances / RAG Pipeline  
**Tags** : `#webgl` `#shaders` `#glsl` `#physique` `#react` `#fluid-dynamics`

---

## 1. Phénoménologie du Ricochet (Impact Initial)

L'interaction entre le curseur (ou le clic) et l'interface doit simuler la collision d'un objet avec la surface de l'eau. Selon les travaux de L. Bocquet (2003), le succès et la forme de l'onde d'un ricochet dépendent de la conservation de la quantité de mouvement et de la force hydrodynamique.

Lorsqu'un événement est capturé (ex: `onPointerDown`), l'énergie transférée à la grille de la surface peut être modélisée par une force d'impact locale. La pression hydrodynamique générée à la surface crée une cavité initiale (le cratère d'impact).

La distribution spatiale de cette énergie lors d'un clic peut être modélisée par une fonction Gaussienne 2D :

$$E(x,y) = A \cdot e^{-\frac{(x - x_c)^2 + (y - y_c)^2}{2\sigma^2}}$$

* $A$ : Amplitude (force du clic ou vélocité du mouvement).
* $(x_c, y_c)$ : Coordonnées de l'impact.
* $\sigma$ : Rayon de la perturbation (taille du curseur ou de la zone d'interaction).

**Implémentation Fluxa :** impact = cavité (amplitude négative). On ne touche que la hauteur courante, pas $h_{t-1}$, pour former l'anneau qui se propage vers l'extérieur.

---

## 2. Dynamique de Propagation (Ondes de Surface)

Une fois l'énergie injectée, la surface de l'interface doit se déformer. Dans un fluide, deux forces de rappel entrent en jeu :

1. **La gravité** (pour les ondes longues, les grandes déformations).
2. **La tension superficielle** (pour les ondes capillaires, les petites ridules rapides).

Pour un rendu en temps réel à 60 FPS, la simulation complète de Navier-Stokes est trop coûteuse. L'approche standard (Müller et al.) utilise l'équation d'onde bidimensionnelle discrétisée.

L'équation d'onde continue pour l'élévation de la surface $h(x,y,t)$ s'exprime ainsi :

$$\frac{\partial^2 h}{\partial t^2} = c^2 \nabla^2 h - \mu \frac{\partial h}{\partial t}$$

* $c$ : Célérité (vitesse de propagation de l'onde).
* $\nabla^2 h$ : Le Laplacien de la hauteur, représentant la différence entre un point et ses voisins.
* $\mu$ : Coefficient d'amortissement (viscosité du fluide, pour que l'UI finisse par se stabiliser).

**Discrétisation FTCS / Verlet (forme utilisée) :**

$$h^{n+1} = \frac{2 h^n - (1 - \gamma)\, h^{n-1} + r^2\, \nabla^2 h^n}{1 + \gamma}$$

avec $r^2 = (c\,\Delta t / \Delta x)^2$ (nombre de Courant) ≤ 0.5 pour la stabilité 2D, et $\gamma$ lié à $\mu$.

---

## 3. Discrétisation pour le Pipeline WebGL (Ping-Pong Buffers)

État RG32F : `R = h(t)`, `G = h(t-1)`. Ping-pong FBO à chaque frame.

Références : Hugo Elias heightfield water, Three.js GPGPU water, Bocquet (2003) ricochets.

---

## 4. Recommandations d'Architecture Frontend

* **Séparation des Boucles** : `requestAnimationFrame` autonome ; React n'injecte que des impulsions (pas de re-render pour la physique).
* **Idle State** : léger bruit basse fréquence optionnel (désactivé tant que rest-pause est prioritaire).
* **Normales** : gradient de la heightmap pour réfraction (Step 2).
* **Aspect** : la grille de sim doit suivre le ratio du canvas (sinon les cercles deviennent des ellipses).
