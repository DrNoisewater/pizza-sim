// Names and review lines. All original copy.

export const FIRST_NAMES = [
  'Marco', 'Gina', 'Luca', 'Rosa', 'Tony', 'Sofia', 'Dante', 'Aria', 'Enzo', 'Mia', 'Nico', 'Lena', 'Sal', 'Bea',
  'Omar', 'Priya', 'Jamal', 'Keiko', 'Diego', 'Hana', 'Theo', 'Zoe', 'Ravi', 'Ines', 'Felix', 'Maya', 'Owen', 'Tess',
  'Kofi', 'Yara', 'Sam', 'Lucia', 'Ben', 'Nina', 'Mateo', 'Ava', 'Hugo', 'Elif', 'Leo', 'Ruth', 'Andre', 'Wren',
  'Paolo', 'Daria', 'Chen', 'Ola', 'Ivan', 'Noor',
];
export const LAST_INITIALS = 'ABCDEFGHJKLMNOPRSTVWYZ';

export type ReviewTopic = 'slow' | 'fast' | 'tasty' | 'bland' | 'pricey' | 'value' | 'dirty' | 'vibe' | 'deliveryFast' | 'deliverySlow' | 'soldout' | 'walkout' | 'refund';

export const REVIEW_LINES: Record<ReviewTopic, string[]> = {
  slow: ['Waited ages for my order.', 'Food was fine, the wait was not.', 'Slow service tonight. Bring a book.', 'Forty minutes for two pies? Come on.'],
  fast: ['In and out in no time.', 'Order was up before I sat down.', 'Fastest pizza on the block.'],
  tasty: ['Best crust in town, hands down.', 'That cheese pull! Coming back tomorrow.', 'Perfect char, perfect sauce.', 'Honestly better than the place my nonna liked.', 'Bubbly crust, bright sauce. Loved it.'],
  bland: ['Kind of flavorless.', 'The crust tasted like cardboard.', 'Toppings were skimpy and sad.', 'Fine if you are very hungry.'],
  pricey: ['Tasty but way overpriced.', 'Prices are getting silly.', '$20 for that? No thanks.'],
  value: ['Great pizza for the price.', 'Cheap, hot and good. What else do you want?', 'Feeds the whole family without breaking the bank.'],
  dirty: ['Tables were sticky. Gross.', 'Somebody please mop that floor.', 'Food was ok but the place was a mess.'],
  vibe: ['Love the vibe in here.', 'Cute spot for a date night.', 'Great music, great room, great slice.'],
  deliveryFast: ['Arrived hot and fast!', 'Driver was quick and friendly.', 'Still steaming when it got here.'],
  deliverySlow: ['Delivery showed up cold.', 'Took forever to arrive.', 'Driver must have taken the scenic route.'],
  soldout: ['They were out of what I wanted.', 'Half the menu was sold out.'],
  walkout: ['Line was too long, gave up.', 'Nobody at the counter. Left.'],
  refund: ['Never got my food. Had to ask for a refund.', 'Gave up waiting and got my money back.'],
};
