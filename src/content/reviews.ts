/**
 * Placeholder reviews. Real reviews populate after the Firestorm campaign.
 * Wave 1 / launch: replace with real review data sourced from LocalCraze widget.
 */
export interface Review {
  name: string;
  role: string;
  rating: 1 | 2 | 3 | 4 | 5;
  quote: string;
}

export const reviews: Review[] = [
  {
    name: 'Maria S.',
    role: 'Parent of two Little Champions',
    rating: 5,
    quote:
      'Both of my kids look forward to class every week. The coaches are patient and the structure has done wonders for their confidence at school.',
  },
  {
    name: 'Daniel R.',
    role: 'Adult student, 18 months',
    rating: 5,
    quote:
      'I came in completely out of shape and intimidated. A year and a half later I am the strongest, calmest version of myself I have ever been.',
  },
  {
    name: 'Jessica L.',
    role: 'Adult Fundamentals student',
    rating: 5,
    quote:
      'The Fundamentals program is perfect for total beginners. The vibe on the mats is welcoming, professional, and surprisingly fun.',
  },
  {
    name: 'Carlos M.',
    role: 'Parent of a Junior',
    rating: 5,
    quote:
      'My son was being picked on at school and was afraid to stand up for himself. Six months in, the bullying stopped. He is more focused, more confident, and a kinder kid.',
  },
];
