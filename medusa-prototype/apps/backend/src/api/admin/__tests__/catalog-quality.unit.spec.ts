import { GET } from "../catalog-quality/route"

describe("catalog quality listing", () => {
  it("filters across query pages before paginating the result", async () => {
    const graph = jest.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, title: "Other", images: [{ url: "/photo" }] })) })
      .mockResolvedValueOnce({ data: [{ id: "match", title: "Needle", images: [] }] })
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() }
    await GET({ query: { filter: "noPhotos", q: "needle" }, scope: { resolve: () => ({ graph }) } } as never, res as never)
    expect(graph).toHaveBeenCalledTimes(2)
    expect(graph.mock.calls[1][0].pagination.skip).toBe(100)
    expect(res.json).toHaveBeenCalledWith({ products: [expect.objectContaining({ id: "match", noPhotos: true })], count: 1 })
  })
  it("rejects invalid pagination and unknown filters", async () => {
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() }
    await GET({ query: { offset: "-1" } } as never, res as never)
    expect(res.status).toHaveBeenCalledWith(400)
    await GET({ query: { filter: "unsupported" } } as never, res as never)
    expect(res.status).toHaveBeenCalledTimes(2)
  })
})
