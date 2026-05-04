/**
 * Four age-tier programs offered at Gracie Barra Whittier.
 * Wave 1 page-builders: refine blurbs from the official build brief Part 3 if needed.
 */
export interface Program {
  slug: string;
  name: string;
  ageRange: string;
  blurb: string;
  href: string;
}

export const programs: Program[] = [
  {
    slug: 'tiny-champions',
    name: 'Tiny Champions',
    ageRange: 'Ages 3-4',
    blurb:
      'Playful, structured classes that build coordination, focus, and confidence through fun BJJ-based games.',
    href: '/kids-martial-arts#tiny-champions',
  },
  {
    slug: 'little-champions',
    name: 'Little Champions',
    ageRange: 'Ages 5-9',
    blurb:
      'Foundational Brazilian Jiu-Jitsu skills, anti-bullying lessons, and respect-driven mat time for early learners.',
    href: '/kids-martial-arts#little-champions',
  },
  {
    slug: 'juniors',
    name: 'Juniors',
    ageRange: 'Ages 10-15',
    blurb:
      'Real Brazilian Jiu-Jitsu technique, fitness, and discipline for tweens and teens — no contact sparring required to start.',
    href: '/kids-martial-arts#juniors',
  },
  {
    slug: 'adults',
    name: 'Adults',
    ageRange: 'Ages 16+',
    blurb:
      'World-class BJJ for fitness, self-defense, and competition. Beginners welcome; Fundamentals classes daily.',
    href: '/adults-jiu-jitsu',
  },
];
