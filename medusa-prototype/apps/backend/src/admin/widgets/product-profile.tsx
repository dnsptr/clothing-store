import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { Container } from "@medusajs/ui"
import { ProductEditor } from "../components/product-editor"

const ProductProfileWidget = ({ data }: DetailWidgetProps<AdminProduct>) => <Container><ProductEditor key={data.id} id={data.id} /></Container>
export const config = defineWidgetConfig({ zone: "product.details" })
export default ProductProfileWidget
