# Shop and night mode

Shop tabs replace only the item grid. Keep the dialog height, tab focus and each tab's scroll
position stable. Purchases update the balance and item states in place.

Box styles share their geometry between the shop preview and the game. Keep the gameplay colour
on the main body, leave the number visible on top and use neutral trim so mystery boxes do not
reveal their hidden colour. The selected style applies to all boxes when a level starts.

Each style has its own construction: the wooden crate has planks and diagonal braces, the picnic
basket tapers and uses woven reeds, and the metal case has an enamel lid,
latches and a folded handle. Keep the classic box's original rounded shape and material without
added decoration. Basket lids have no checked fabric or other patterns. Keep
decoration below the number plane, with an uncluttered centre on the lid. Bake neutral details
into shared meshes by material so added parts do not each cost a draw call.
Box numbers sit slightly toward the front of the lid for optical centring, using the same
offset in the game and shop. Hovering a box only changes the pointer cursor; it does not
predict or highlight cells on the board. Cell selection stays with the simulation.

Night mode uses light text on dark panels. Secondary text uses `--ink-muted`; prices and rewards
use `--ink-gold`. Check these against their panel backgrounds when adding new screens.

Settings and credits retain the game's raised coloured heading, round red close button and
glossy action buttons. Keep the heading and credits footer outside the scrolling content.
Settings align labels and controls; the debug
hint has its own full-width line. Use percentages beside the audio sliders and update theme
and debug selections in place. Keep the reset button smaller and retain confirmation.
Credits group the existing attribution by source, with separate project and license links.
Leave room around the scroller for focus outlines. Footer buttons use a solid raised edge
without a diffuse shadow, so the scrolling boundary does not cut the shadow into a rectangle.

Ant accessories share the same geometry in the shop and during play. The party cone needs a
clear silhouette above the antennae, and the cap needs a broad forward visor. Use a turquoise
ribbon bow for contrast with orange ants. The large daisy faces forward and upward so its
petals remain visible from both camera angles. Santa's hat has a broad fabric base, a drooping
tapered tip and white trim. Preserve the sunglasses, top hat and crown.
