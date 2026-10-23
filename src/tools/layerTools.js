import { arcgisClient } from '../arcgisClient.js';
import { LAYER_CATALOG, resolveLayerId } from '../config.js';

export async function listLayersTool({ category, search }) {
  const service = await arcgisClient.getServiceMetadata();
  const allItems = [
    ...(service.layers || []).map(l => ({ ...l, itemType: 'layer' })),
    ...(service.tables || []).map(t => ({ ...t, itemType: 'table', geometryType: 'None (Table)' }))
  ];

  let results = allItems.map(item => {
    const catalogEntry = Object.values(LAYER_CATALOG).find(c => c.id === item.id);
    return {
      id: item.id,
      name: item.name,
      itemType: item.itemType,
      geometryType: item.geometryType,
      description: catalogEntry ? catalogEntry.description : (item.description || 'No description available')
    };
  });

  if (search) {
    const term = search.toLowerCase();
    results = results.filter(r =>
      r.name.toLowerCase().includes(term) ||
      r.description.toLowerCase().includes(term) ||
      String(r.id) === term
    );
  }

  if (category) {
    const cat = category.toLowerCase();
    if (cat === 'substation') {
      results = results.filter(r => r.name.toLowerCase().includes('substation'));
    } else if (cat === 'feeder' || cat === 'circuit') {
      results = results.filter(r => r.name.toLowerCase().includes('feeder') || r.name.toLowerCase().includes('circuit'));
    } else if (cat === 'ica' || cat === 'capacity') {
      results = results.filter(r => r.name.toLowerCase().includes('ica') || r.name.toLowerCase().includes('line'));
    } else if (cat === 'fire') {
      results = results.filter(r => r.name.toLowerCase().includes('fire'));
    } else if (cat === 'load') {
      results = results.filter(r => r.name.toLowerCase().includes('load'));
    } else if (cat === 'project') {
      results = results.filter(r => r.name.toLowerCase().includes('project') || r.name.toLowerCase().includes('dur') || r.name.toLowerCase().includes('lnba'));
    }
  }

  return {
    serviceName: service.serviceDescription || service.name || 'DRPComplianceRelProd',
    totalAvailable: results.length,
    layers: results
  };
}

export async function getLayerDetailsTool({ layer }) {
  const layerId = resolveLayerId(layer);
  const details = await arcgisClient.getLayerDetails(layerId);
  const catalogEntry = Object.values(LAYER_CATALOG).find(c => c.id === layerId);

  return {
    id: details.id,
    name: details.name,
    type: details.type,
    geometryType: details.geometryType || 'None (Table)',
    description: catalogEntry?.description || details.description || details.snippet || '',
    capabilities: details.capabilities,
    maxRecordCount: details.maxRecordCount,
    supportsPagination: details.advancedQueryCapabilities?.supportsPagination ?? details.supportsPagination,
    fieldsCount: details.fields ? details.fields.length : 0,
    fields: (details.fields || []).map(f => ({
      name: f.name,
      alias: f.alias,
      type: f.type,
      length: f.length || undefined,
      nullable: f.nullable
    })),
    relationships: details.relationships || [],
    extent: details.extent || null
  };
}
