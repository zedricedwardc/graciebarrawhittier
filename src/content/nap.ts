/**
 * Single source of truth for Name / Address / Phone (NAP).
 * Used by Footer, SchemaLocalBusiness, Contact page, hero floating card.
 * Changing values here flows everywhere — do not duplicate in components.
 */
export const nap = {
  name: 'Gracie Barra Whittier',
  address: '13595 Whittier Blvd. #104, Whittier, CA 90605',
  streetAddress: '13595 Whittier Blvd. #104',
  addressLocality: 'Whittier',
  addressRegion: 'CA',
  postalCode: '90605',
  addressCountry: 'US',
  phone: '(562) 640-1400',
  phoneTel: '+15626401400',
  email: 'info@gbwhittier.com',
  geo: {
    latitude: 33.9385,
    longitude: -118.0149,
  },
  priceRange: '$$',
  serviceAreas: ['Whittier', 'La Habra', 'La Mirada', 'Pico Rivera'],
} as const;

export type Nap = typeof nap;
