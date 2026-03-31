import { client } from '../config/axios.js';

function getCurrentMonthFilter(timeZone = process.env.FACTURAS_CLUBFACTURA_TIMEZONE || 'America/Mazatlan') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === 'year')?.value || 0);
  const month = Number(parts.find((part) => part.type === 'month')?.value || 0);

  if (!year || !month) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };
  }

  return { year, month };
}

export async function obtenerFacturasEmitidas({ empresa, pageNumber = 1, pageSize = 100 }) {
  const { year, month } = getCurrentMonthFilter();
  const response = await client.post('/api/CFDI/GetCfdisList', {
    empresa,
    filtrarPorFecha: true,
    anio: year,
    mes: month,
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
