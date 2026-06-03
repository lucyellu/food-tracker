import { revalidateTag } from "next/cache";

export const FOOD_DATA_CACHE_TAG = "food-data";
export const FOOD_DATA_CACHE_SECONDS = 3600;

export function revalidateFoodDataCache() {
  revalidateTag(FOOD_DATA_CACHE_TAG, { expire: 0 });
}
