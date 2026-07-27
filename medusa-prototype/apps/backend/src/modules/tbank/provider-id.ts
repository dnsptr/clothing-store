/**
 * Medusa строит runtime id как `pp_${service.identifier}_${config.id}`.
 * Для identifier `tbank` и config id `tbank` webhook-события используют тот
 * же идентификатор без префикса `pp_`.
 */
export const TBANK_PROVIDER_IDENTIFIER = "tbank";
export const TBANK_PROVIDER_CONFIG_ID = "tbank";
export const TBANK_PROVIDER_EVENT_ID =
  `${TBANK_PROVIDER_IDENTIFIER}_${TBANK_PROVIDER_CONFIG_ID}`;
export const TBANK_PAYMENT_PROVIDER_ID = `pp_${TBANK_PROVIDER_EVENT_ID}`;
