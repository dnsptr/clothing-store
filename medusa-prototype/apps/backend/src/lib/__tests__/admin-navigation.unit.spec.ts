import { ADMIN_SECTIONS, storeSidebarConfiguration } from "../admin-navigation"

describe("store admin navigation", () => {
  it("has unique paths and Russian labels", () => {
    expect(new Set(ADMIN_SECTIONS.map(section => section.path)).size).toBe(ADMIN_SECTIONS.length)
    for (const section of ADMIN_SECTIONS) expect(section.label).toMatch(/[А-Яа-я]/)
  })
  it("orders working and planned sections without removing the order page", () => {
    const { widgets } = storeSidebarConfiguration()
    ADMIN_SECTIONS.forEach((section, order) => {
      expect(widgets[`core:nav:${section.path}`]).toEqual({ hidden: false, order })
    })
    expect(widgets["core:nav:/orders"].hidden).toBe(false)
    expect(widgets["core:nav:/catalog-editor"].hidden).toBe(false)
  })
  it("hides duplicate technical menus and separator but keeps search", () => {
    const { widgets } = storeSidebarConfiguration()
    for (const path of ["products", "inventory", "customers", "promotions", "price-lists"]) {
      expect(widgets[`core:nav:/${path}`].hidden).toBe(true)
    }
    expect(widgets["core:Divider"].hidden).toBe(true)
    expect(widgets["core:Searchbar"]).toEqual({ order: -1 })
  })
})
