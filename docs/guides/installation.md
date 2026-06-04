# installation

Tests relative links that go **up** and **sideways** in the tree.

## prerequisites

- node 18+
- a directory with `.md` / `.mmd` files

## steps

1. see the [project index](../README.md) (up one level)
2. then read [configuration](configuration.md) (same folder)
3. if stuck, the [troubleshooting guide](troubleshooting.md) (same folder)
4. jump straight to [a config anchor](configuration.md#env-overrides) (cross-doc anchor)

## a deliberately dead link

This one points at a file that does not exist - clicking it should show a
friendly "not found" state, not a blank screen:

[missing page](./does-not-exist.md)
