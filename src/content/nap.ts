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
  social: {
    instagram: 'https://www.instagram.com/graciebarrawhittier/',
    facebook: 'https://www.facebook.com/graciebarrawhittier/',
    googleBusiness: 'https://share.google/6bdDUn4PBYx81HmW4',
    yelp: 'https://www.yelp.com/biz/gracie-barra-whittier-whittier',
  },
  /**
   * Public Google Business Profile rating and review count.
   * Used by SchemaLocalBusiness `aggregateRating` for AI search engines.
   * Refresh manually when GMB changes meaningfully (every few months is fine).
   */
  rating: {
    average: 5.0,
    count: 120,
  },
  /**
   * Academy opening hours, derived from src/data/schedule.ts.
   * Mon–Fri: trial Fundamentals 11am, evening classes through 7pm → close at 8pm.
   * Sat: kids 10am, adult Fundamentals 12pm → close at 1pm.
   * Sun: closed.
   */
  hours: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '11:00', closes: '20:00' },
    { days: ['Saturday'], opens: '10:00', closes: '13:00' },
  ],
} as const;

export type Nap = typeof nap;
