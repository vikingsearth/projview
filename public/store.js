/* shared client state - one mutable object the modules read/write */

export const state = {
  currentPath: null,        // path of the file currently shown
  expanded: new Set(),      // dir paths the user has opened
  treeData: [],             // last tree payload from the server
  rootName: 'projview',     // indexed root's display name
  writable: false,          // can this client create/edit comments + files? (loopback only)
  view: 'rendered',         // md / mmd: 'rendered' or 'raw' - sticks while browsing
  persistent: false         // does the store keep comments + versions across runs?
};
