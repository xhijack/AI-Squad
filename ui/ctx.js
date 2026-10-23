// Shared app context so feature modules (wizard, templates, edit mode) can read state and trigger refreshes.
export const ctx = {
  state: { route: { mode: 'lobby' }, building: null, floor: null, desk: null, roles: null },
  refresh: async () => {},
  render: () => {},
  scene: null,
  actions: {},                 // data-act handlers; feature modules add their own
};
