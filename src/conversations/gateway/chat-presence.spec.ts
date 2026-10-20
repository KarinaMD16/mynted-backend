import { ChatPresence } from './chat-presence';

describe('ChatPresence', () => {
  it('goes online with the first socket and offline only after the last', () => {
    const presence = new ChatPresence();

    expect(presence.connect('u1', 'tab-1')).toBe(true);
    expect(presence.connect('u1', 'tab-2')).toBe(false);
    expect(presence.isOnline('u1')).toBe(true);

    expect(presence.disconnect('u1', 'tab-1')).toBe(false);
    expect(presence.isOnline('u1')).toBe(true);
    expect(presence.disconnect('u1', 'tab-2')).toBe(true);
    expect(presence.isOnline('u1')).toBe(false);
  });

  it('ignores unknown or repeated disconnects', () => {
    const presence = new ChatPresence();
    presence.connect('u1', 'tab-1');

    expect(presence.disconnect('u2', 'x')).toBe(false);
    expect(presence.disconnect('u1', 'x')).toBe(false);
    expect(presence.disconnect('u1', 'tab-1')).toBe(true);
    expect(presence.disconnect('u1', 'tab-1')).toBe(false);
  });

  it('tracks users independently', () => {
    const presence = new ChatPresence();
    presence.connect('u1', 'a');
    presence.connect('u2', 'b');
    presence.disconnect('u1', 'a');

    expect(presence.isOnline('u1')).toBe(false);
    expect(presence.isOnline('u2')).toBe(true);
  });
});
