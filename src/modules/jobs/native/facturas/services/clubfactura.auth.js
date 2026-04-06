import { client } from '../config/axios.js';

export async function loginClubFactura() {
  let response;
  try {
    response = await client.post('/api/auth/login', {
      userName: process.env.FACTURAS_CLUBFACTURA_USER,
      password: process.env.FACTURAS_CLUBFACTURA_PASSWORD
    });
  } catch (error) {
    const status = error?.response?.status;
    const apiMessage = error?.response?.data?.Message || error?.response?.data?.message;

    if (apiMessage) {
      throw new Error(`ClubFactura login fallo (${status || 'sin estatus'}): ${apiMessage}`);
    }

    throw error;
  }

  const token = response.data?.token;
  if (!token) throw new Error('No se recibio token de ClubFactura');
  client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  return token;
}
