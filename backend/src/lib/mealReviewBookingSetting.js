let requireReviewToBookMeals = false;

export function getRequireReviewToBookMeals() {
  return requireReviewToBookMeals;
}

export function setRequireReviewToBookMeals(enabled) {
  requireReviewToBookMeals = enabled;
  return requireReviewToBookMeals;
}
