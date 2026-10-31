import { describe, expect, it } from 'vitest';

import {
  alternateLocale,
  detectLocale,
  generatorHref,
  homeHref,
  translate,
} from './i18n';

describe('locale routing', () => {
  it('detects generator locales from the public route', () => {
    expect(detectLocale('/generator/')).toBe('ru');
    expect(detectLocale('/en/generator/')).toBe('en');
  });

  it('builds locale-aware home and generator links', () => {
    expect(generatorHref('ru')).toBe('/generator/');
    expect(generatorHref('en')).toBe('/en/generator/');
    expect(homeHref('ru')).toBe('/');
    expect(homeHref('en')).toBe('/en/');
    expect(alternateLocale('ru')).toBe('en');
  });
});

describe('translations', () => {
  it('interpolates localized runtime values', () => {
    expect(translate('en', 'search.description', {
      suffix: '…TON, …GRAM',
      version: 'W5',
      engine: 'GPU · WebGPU',
    })).toContain('Searching for …TON, …GRAM in W5 addresses · GPU · WebGPU.');
  });
});
