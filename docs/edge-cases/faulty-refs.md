# faulty refs

Every internal link here is broken on purpose. None should crash the app;
each should land on the "not found" state (for files) or no-op (for anchors).

## dead file links

- [sibling that doesn't exist](nonexistent.md)
- [up into a missing folder](../../way/up/gone.md)
- [a missing .mmd](missing-diagram.mmd)

## dead anchors

- [missing anchor on this page](#not-a-real-heading)

## non-previewable (should be ignored, not navigated)

- [an image link](../assets/picture.png)
- [a pdf link](../assets/manual.pdf)

## one valid link for contrast

- [back to the index](../README.md)
