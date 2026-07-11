export type ImportProvider = 'mercadolibre' | 'zonaprop' | 'ficha-info' | 'generic';

export interface ImportedPropertyData {
  title?: string; propertyType?: string; operation?: string; zone?: string; approxAddress?: string;
  price?: string; expenses?: string; bedrooms?: string; bathrooms?: string; garage?: string;
  coveredMeters?: string; totalMeters?: string; age?: string; status?: string; amenities?: string;
  description?: string; deed?: string; creditReady?: string; paymentMethod?: string; photoUrls: string[];
}

export interface ImportPropertyResponse {
  success: boolean;
  provider: ImportProvider;
  data: ImportedPropertyData;
  warnings: string[];
  error?: string;
}
