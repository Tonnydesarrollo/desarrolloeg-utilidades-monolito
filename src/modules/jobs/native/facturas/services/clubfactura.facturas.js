import { client } from '../config/axios.js';

export async function obtenerFacturasEmitidas({ empresa, pageNumber = 1, pageSize = 100 }) {
  const response = await client.post('/api/CFDI/GetCfdisList', {
    empresa,
    filtrarPorFecha: false,
    anio: null,
    mes: null,
    estatus: 1,
    tipoCFDI: null,
    filter: '',
    pageNumber,
    pageSize,
    sorting: 'fecha DESC'
  });

  const data = response.data;
  const baseUrl = client.defaults.baseURL?.replace(/\/+$/, '');
  const proxyBase = process.env.FACTURAS_DOWNLOAD_PROXY_BASE?.replace(/\/+$/, '');
  const proxyKey = process.env.FACTURAS_DOWNLOAD_PROXY_KEY;

  if (Array.isArray(data?.items) && baseUrl) {
    const keyParam = proxyKey ? `?key=${encodeURIComponent(proxyKey)}` : '';
    const downloadBase = `${baseUrl}/api/CFDI/DownloadXml?id=`;
    const pdfDownloadUrl = `${baseUrl}/api/CFDI/DownloadPDF`;
    data.items = data.items.map(item => ({
      ...item,
      xmlDownloadUrl: item?.id ? (proxyBase ? `${proxyBase}/clubfactura/xml/${item.id}${keyParam}` : `${downloadBase}${item.id}`) : null,
      pdfDownloadUrl: item?.id ? (proxyBase ? `${proxyBase}/clubfactura/pdf/${item.id}${keyParam}` : pdfDownloadUrl) : null,
      pdfDownloadPayload: item?.id ? { id: item.id } : null
    }));
  }

  return data;
}
