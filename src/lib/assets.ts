/** Shared between the server and the browser, so it can't import anything from the server. */
export const ASSET_CATEGORIES = [
  "land",
  "building",
  "vehicle",
  "generator",
  "sound",
  "instrument",
  "media",
  "furniture",
  "computer",
  "other",
] as const;
type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  land: "Land",
  building: "Building",
  vehicle: "Vehicle",
  generator: "Generator & power",
  sound: "Sound equipment",
  instrument: "Musical instrument",
  media: "Media & cameras",
  furniture: "Furniture & fittings",
  computer: "Computers & phones",
  other: "Other",
};

/** Typical useful life in months, used as the default when adding an asset. */
export const DEFAULT_LIFE: Record<AssetCategory, number | null> = {
  land: null,
  building: 600,
  vehicle: 60,
  generator: 60,
  sound: 60,
  instrument: 84,
  media: 48,
  furniture: 96,
  computer: 36,
  other: 60,
};

