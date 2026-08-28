// Los odómetros pueden tener un decimal, pero nunca letras, signos ni
// exponentes. Se normaliza también lo que se pega desde el portapapeles.
export const normalizeKilometerInput = value => {
  const text = String(value ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  const decimalAt = text.indexOf('.');
  return decimalAt < 0 ? text : `${text.slice(0, decimalAt + 1)}${text.slice(decimalAt + 1).replaceAll('.', '')}`;
};

export const isPositiveKilometer = value => Number.isFinite(Number(value)) && Number(value) > 0;

export const isArrivalKilometerGreater = (departureKm, arrivalKm) => (
  isPositiveKilometer(arrivalKm) && Number(arrivalKm) > Number(departureKm)
);
