import { client } from '../config/axios.js';

export async function iniciarSesionWeb() {
  await client.get('https://www.clubfactura.mx/cfAppN/account/login');
}
