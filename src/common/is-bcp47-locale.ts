import { ValidateBy, ValidationOptions } from 'class-validator';

// Etiqueta de idioma BCP 47 válida (p. ej. es, es-CR, es-419, en-US), según
// Intl.getCanonicalLocales. Solo valida lo que llega: no reescribe el valor ni
// toca los ya guardados.
export function isBcp47Locale(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

export function IsBcp47Locale(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isBcp47Locale',
      validator: {
        validate: (value: unknown) => isBcp47Locale(value),
        defaultMessage: () =>
          'locale debe ser una etiqueta de idioma BCP 47 (p. ej. es-CR, en-US)',
      },
    },
    options,
  );
}
