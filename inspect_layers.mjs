const baseUrl = 'https://services2.arcgis.com/mJaJSax0KPHoCNB6/ArcGIS/rest/services/DRPComplianceRelProd/FeatureServer';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

async function inspect() {
  console.log('Fetching service metadata...');
  const serviceInfo = await fetchJson(`${baseUrl}?f=json`);
  console.log('Service Info:');
  console.log(`- Name: ${serviceInfo.serviceDescription || serviceInfo.name || 'DRPComplianceRelProd'}`);
  console.log(`- Description: ${serviceInfo.description}`);
  console.log(`- Spatial Ref:`, JSON.stringify(serviceInfo.spatialReference));
  console.log(`- Capabilities: ${serviceInfo.capabilities}`);
  console.log(`- Max Record Count: ${serviceInfo.maxRecordCount}`);
  console.log(`- Layers: ${serviceInfo.layers.length}`);
  console.log(`- Tables: ${serviceInfo.tables.length}\n`);

  const allItems = [
    ...serviceInfo.layers.map(l => ({ ...l, itemType: 'layer' })),
    ...serviceInfo.tables.map(t => ({ ...t, itemType: 'table' }))
  ];

  const summary = [];

  for (const item of allItems) {
    try {
      const detail = await fetchJson(`${baseUrl}/${item.id}?f=json`);
      let count = 'N/A';
      try {
        const countRes = await fetchJson(`${baseUrl}/${item.id}/query?where=1%3D1&returnCountOnly=true&f=json`);
        count = countRes.count !== undefined ? countRes.count : 'N/A';
      } catch (e) {
        count = `Error: ${e.message}`;
      }

      let sampleFields = [];
      let sampleRecord = null;
      try {
        const sampleRes = await fetchJson(`${baseUrl}/${item.id}/query?where=1%3D1&resultRecordCount=1&outFields=*&returnGeometry=false&f=json`);
        if (sampleRes.features && sampleRes.features.length > 0) {
          sampleRecord = sampleRes.features[0].attributes;
        }
      } catch (e) {
        // ignore
      }

      const layerInfo = {
        id: item.id,
        name: item.name,
        itemType: item.itemType,
        geometryType: detail.geometryType || 'None (Table)',
        count,
        maxRecordCount: detail.maxRecordCount,
        supportsPagination: detail.advancedQueryCapabilities?.supportsPagination ?? detail.supportsPagination,
        fieldsCount: detail.fields?.length || 0,
        fields: detail.fields?.map(f => ({
          name: f.name,
          type: f.type,
          alias: f.alias
        })) || [],
        relationships: detail.relationships || [],
        sampleRecord
      };

      summary.push(layerInfo);
      console.log(`[ID ${item.id}] ${item.name} (${layerInfo.geometryType}) -> Count: ${count}, Fields: ${layerInfo.fieldsCount}`);
    } catch (err) {
      console.error(`Error inspecting ${item.id}: ${err.message}`);
    }
  }

  const fs = await import('node:fs/promises');
  await fs.writeFile('schema_summary.json', JSON.stringify(summary, null, 2));
  console.log('\nWrote detailed summary to schema_summary.json');
}

inspect().catch(console.error);
