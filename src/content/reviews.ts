/**
 * Featured Google reviews from real Gracie Barra Whittier students/families.
 * Pulled from the public GHL reputation widget at the launch checkpoint.
 * Refresh occasionally so the featured set stays fresh.
 */
export interface Review {
  name: string;
  role: string;
  rating: 1 | 2 | 3 | 4 | 5;
  quote: string;
  source: 'Google';
}

export const reviews: Review[] = [
  {
    name: 'Fabian L.',
    role: 'Parent of a Little Champion',
    rating: 5,
    quote:
      "Our 7-year-old has been at Gracie Barra for about 6 weeks, and we've already seen growth in confidence, focus, and discipline.",
    source: 'Google',
  },
  {
    name: 'Raymond',
    role: 'Family of a Junior student',
    rating: 5,
    quote:
      "Coach Alex and Coach Phil are amazing instructors! My niece was also in their junior kid classes and had so much fun, they're very clear on breaking down the fundamentals, positioning and teaching, and they want you to succeed in your physical goals or just having a great conversation with them.",
    source: 'Google',
  },
  {
    name: 'M K',
    role: 'Parent',
    rating: 5,
    quote:
      'Definitely recommend bringing your children here to start their Ju Jitsu journey — the coaches are fantastic and patient with the children, whilst maintaining the discipline on the mat.',
    source: 'Google',
  },
  {
    name: 'Aaron G.',
    role: 'Adult student',
    rating: 5,
    quote:
      "From the moment I walked through the doors, I was impressed by the welcoming and professional atmosphere. Whether you're a complete beginner or an experienced practitioner, this school has something for everyone.",
    source: 'Google',
  },
  {
    name: 'Mario M.',
    role: 'Parent',
    rating: 5,
    quote:
      'After the first week my boy began to show lots of interest and now looks forward to the sessions especially the sparring. I highly recommend Gracie Barra jujitsu.',
    source: 'Google',
  },
  {
    name: 'Dolores M.',
    role: 'Adult student',
    rating: 5,
    quote:
      'Everyone there is very understanding and patient with me as I learn. If you are looking for a sense of community then Gracie Barra Whittier is the place for you.',
    source: 'Google',
  },
];
