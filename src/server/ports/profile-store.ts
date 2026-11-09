/**
 * The app's own record of a person's profile (`public.profiles`), apart from the auth provider's
 * user metadata. The profile trigger copies the terms fields from the metadata only once, when
 * the profile row is created, so a later acceptance (the /welcome step, a Google repair, or a
 * code that confirmed someone else's sign-up) is written here by the app itself.
 *
 * Both methods act on one profile by user id and answer whether a row was there to change. They
 * never take a time from the caller: the database's own clock stamps the acceptance.
 */
export interface ProfileStore {
  /**
   * Records that this user confirmed they are 18 or older and accepted `termsVersion` now:
   * sets terms_version, terms_accepted_at and age_confirmed_at, replacing any earlier record.
   */
  recordTermsAcceptance(userId: string, termsVersion: string): Promise<boolean>;
  /**
   * Clears all three terms fields, for an account whose recorded acceptance was made by someone
   * else (a stranger's sign-up that a code then confirmed for the real owner).
   */
  clearTermsAcceptance(userId: string): Promise<boolean>;
}
