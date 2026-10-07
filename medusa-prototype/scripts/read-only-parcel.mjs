const DISPATCH_POINTS = {
  "108811": "Говорово",
  "117574": "Принц Плаза",
  "119571": "Авеню",
};

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for a measured, read-only carrier quote`);
  return value;
}

function positiveInteger(environment, name, maximum) {
  const value = required(environment, name);
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    throw new Error(`${name} must be a positive integer not exceeding ${maximum}`);
  }
  return Number(value);
}

export function readOnlyParcel(environment) {
  const postalCode = required(environment, "DELIVERY_DISPATCH_INDEX");
  const name = Object.hasOwn(DISPATCH_POINTS, postalCode) ? DISPATCH_POINTS[postalCode] : undefined;
  if (!name) throw new Error("DELIVERY_DISPATCH_INDEX must be 108811, 117574 or 119571");
  const address = required(environment, "DELIVERY_DISPATCH_ADDRESS");
  const weight = positiveInteger(environment, "DELIVERY_WEIGHT_GRAMS", 100_000);
  const length = positiveInteger(environment, "DELIVERY_LENGTH_CM", 300);
  const width = positiveInteger(environment, "DELIVERY_WIDTH_CM", 300);
  const height = positiveInteger(environment, "DELIVERY_HEIGHT_CM", 300);
  const assessedInput = required(environment, "DELIVERY_ASSESSED_PRICE_RUB");
  const assessedPrice = Number(assessedInput);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(assessedInput) ||
    !Number.isFinite(assessedPrice) || assessedPrice <= 0 || assessedPrice > 100_000_000) {
    throw new Error("DELIVERY_ASSESSED_PRICE_RUB must be a positive amount in rubles with at most two decimals");
  }
  return {
    dispatch: { postalCode, name, address },
    parcel: { weight, length, width, height, assessedPrice },
  };
}
