/** The ready medicine list pharmacies start with, as the website states it.
 *
 * The website shows it only once the medicines really are in the shared
 * pharmacy catalogue: after sharing them (Super Admin > Catalog Review), set
 * `shared` to true. */
export const MEDICINE_CATALOGUE = {
  shared: false as boolean,
  count: "73,000+",
};

/** "73,000+ medicines added", or null while they are not in the catalogue yet. */
export const medicinesAdded = () => (MEDICINE_CATALOGUE.shared ? `${MEDICINE_CATALOGUE.count} medicines added` : null);

/** The business types that start with the pharmacy catalogue. */
export const hasMedicineCatalogue = (typeId: string) => typeId === "retail_pharmacy" || typeId === "medical_store" || typeId === "hospital_pharmacy";
