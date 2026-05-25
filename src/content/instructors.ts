/**
 * Lead instructors at Gracie Barra Whittier.
 * Bios intentionally minimal — expand once we have rank/lineage/years training.
 */
export interface Instructor {
  slug: string;
  name: string;
  jobTitle: string;
  image: string;
  description: string;
}

export const instructors: Instructor[] = [
  {
    slug: 'professor-phil',
    name: 'Professor Phil',
    jobTitle: 'Lead Adult Brazilian Jiu-Jitsu Instructor',
    image: '/images/instructors/professor-phil.jpg',
    description:
      'Professor Phil leads the adult program at Gracie Barra Whittier, teaching the GB1 Fundamentals, GB2 Advanced, and GB3 Competition classes using the official Gracie Barra curriculum.',
  },
  {
    slug: 'professor-eric',
    name: 'Professor Eric',
    jobTitle: 'Lead Brazilian Jiu-Jitsu Instructor',
    image: '/images/instructors/professor-eric.jpg',
    description:
      'Professor Eric is a lead instructor at Gracie Barra Whittier, teaching certified Gracie Barra curriculum to kids and adults across the academy.',
  },
];
