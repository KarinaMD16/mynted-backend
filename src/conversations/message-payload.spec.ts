import { MessageType } from './enums/message-type.enum';
import { imageMessagePayload, textMessagePayload } from './message-payload';

describe('message payloads', () => {
  it('forces type text and no image for text messages', () => {
    expect(textMessagePayload({ content: 'Hola' })).toEqual({
      type: MessageType.TEXT,
      content: 'Hola',
      imageUrl: null,
    });
  });

  it('builds image messages from the Cloudinary upload result', () => {
    const url = 'https://res.cloudinary.com/mynted/image/upload/v1/chat/a.jpg';

    expect(imageMessagePayload({ url })).toEqual({
      type: MessageType.IMAGE,
      content: null,
      imageUrl: url,
    });
  });
});
