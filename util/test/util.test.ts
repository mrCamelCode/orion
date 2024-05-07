import { assert, assertEquals } from 'assert';
import { describe, test } from 'bdd';
import { generateBase36Id } from '../util.ts';

describe('Util', () => {
  describe('generateBase36Id', () => {
    test('creates an ID with only A-Z, 0-9 characters', () => {
      const reg = /[A-Z0-9]/;

      assert(
        generateBase36Id()
          .split('')
          .every((char) => reg.test(char))
      );
    });
    test('obeys the provided length', () => {
      assertEquals(generateBase36Id(5).length, 5);
      assertEquals(generateBase36Id(3).length, 3);
      assertEquals(generateBase36Id(1).length, 1);
      assertEquals(generateBase36Id(10).length, 10);
    });
  });
});
