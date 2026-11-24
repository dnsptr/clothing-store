// One-time links from the original spreadsheet, not global color aliases.
// Equal source labels still retain separate offer IDs and separate variants.
export const LEGACY_VARIANT_MIGRATIONS = [
  { article: "1301", sku: "MM-1301-OS-06", color: "лён", sourceColor: "льняной", offerId: "9404c50f-4b8b-11f1-9646-e45be2b6c48c#dae3cbdd-5bdc-11f1-9647-f6f254692cab" },
  { article: "1351", sku: "MM-1351-OS-11", color: "лён", sourceColor: "льняной", offerId: "08d4147d-5bdc-11f1-9647-f6f254692cab#0ed1c690-5bdc-11f1-9647-f6f254692cab" },
  { article: "1351", sku: "MM-1351-OS-12", color: "светло пудровый", sourceColor: "светлая пудра", offerId: "08d4147d-5bdc-11f1-9647-f6f254692cab#0ed1c6d4-5bdc-11f1-9647-f6f254692cab" },
  { article: "1453-1", sku: "MM-1453-1-OS-05", color: "светло-бежый", sourceColor: "светло-бежевый", offerId: "b190b643-8f8b-11f1-9649-a33b15543e6c#c73d3375-8f8b-11f1-9649-a33b15543e6c" },
  { article: "1592", sku: "MM-1592-OS-08", color: "лён", sourceColor: "льняной", offerId: "1bd0991f-5bdc-11f1-9647-f6f254692cab#1dcd7a47-5bdc-11f1-9647-f6f254692cab" },
  { article: "1603", sku: "MM-1603-OS-06", color: "кораловый", sourceColor: "коралловый", offerId: "1f782778-5bdc-11f1-9647-f6f254692cab#20bdae2b-5bdc-11f1-9647-f6f254692cab" },
  { article: "1647", sku: "MM-1647-OS-11", color: "щоколадный", sourceColor: "шоколадный", offerId: "206cc7b0-5cb1-11f1-9647-f6f254692cab#eded06fb-5e73-11f1-9647-f6f254692cab" },
  { article: "1760", sku: "MM-1760-OS-01", color: "бордовый/белый", sourceColor: "белый/бордовый", offerId: "2ea53f94-5bdc-11f1-9647-f6f254692cab#2ea53f95-5bdc-11f1-9647-f6f254692cab" },
  { article: "1760", sku: "MM-1760-OS-02", color: "Синий/белый", sourceColor: "белый/синий", offerId: "2ea53f94-5bdc-11f1-9647-f6f254692cab#2ea53fd9-5bdc-11f1-9647-f6f254692cab" },
  { article: "1897", sku: "MM-1897-OS-02", color: "голубой/белый", sourceColor: "белый/голубой", offerId: "534aeda5-5bdc-11f1-9647-f6f254692cab#534aeda6-5bdc-11f1-9647-f6f254692cab" },
  { article: "1897", sku: "MM-1897-OS-03", color: "джиновый/белый", sourceColor: "ДЖИНСОВЫЙ/БЕЛЫЙ", offerId: "534aeda5-5bdc-11f1-9647-f6f254692cab#fb92e959-846b-11f1-9649-a33b15543e6c" },
  { article: "1897", sku: "MM-1897-OS-04", color: "зелёный/бежевый", sourceColor: "бежевый/зеленый", offerId: "534aeda5-5bdc-11f1-9647-f6f254692cab#534aede9-5bdc-11f1-9647-f6f254692cab" },
  { article: "1897", sku: "MM-1897-OS-09", color: "темно кофейный/кремовый", sourceColor: "темно-кофе/кремовый", offerId: "534aeda5-5bdc-11f1-9647-f6f254692cab#39517017-6ef4-11f1-9648-e2bcd22d0ba6" },
  { article: "1917", sku: "MM-1917-OS-05", color: "капучино/светло-беж", sourceColor: "КАПУЧИНО/СВЕТЛО-БЕЖЕВЫЙ", offerId: "5ba5acee-5bdc-11f1-9647-f6f254692cab#5bb18ae6-5bdc-11f1-9647-f6f254692cab" },
] as const
