export const fisherYatesShuffleInPlace = <T,>(array: T[], rng: () => number = Math.random): T[] => {
  // Fisher-Yates gives each permutation an equal chance in O(n) time.
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
};

export const fisherYatesShuffle = <T,>(array: T[], rng: () => number = Math.random): T[] => {
  return fisherYatesShuffleInPlace([...array], rng);
};
