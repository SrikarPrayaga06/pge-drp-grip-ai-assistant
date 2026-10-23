import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMcpTests() {
  console.log('--- Starting MCP Server Integration Tests ---');

  const serverPath = path.resolve(__dirname, '../src/index.js');
  console.log(`Spawning MCP Server subprocess: node ${serverPath}`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath]
  });

  const client = new Client(
    { name: 'mcp-test-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✓ Successfully connected to MCP server over Stdio transport');

  // Test 1: List Tools
  console.log('\n[Test 1] Listing tools...');
  const toolsResult = await client.listTools();
  console.log(`✓ Received ${toolsResult.tools.length} tools:`);
  for (const t of toolsResult.tools) {
    console.log(`  - ${t.name}: ${t.description.slice(0, 70)}...`);
  }

  if (toolsResult.tools.length < 10) {
    throw new Error(`Expected at least 10 tools, got ${toolsResult.tools.length}`);
  }

  // Test 2: arcgis_list_layers
  console.log('\n[Test 2] Calling arcgis_list_layers (category: "substation")...');
  const listRes = await client.callTool({
    name: 'arcgis_list_layers',
    arguments: { category: 'substation' }
  });
  const listData = JSON.parse(listRes.content[0].text);
  console.log(`✓ Returned ${listData.totalAvailable} substation layers:`, listData.layers.map(l => `ID ${l.id} (${l.name})`).join(', '));

  // Test 3: arcgis_get_layer_details
  console.log('\n[Test 3] Calling arcgis_get_layer_details (layer: 0 / EDSubstations)...');
  const detailsRes = await client.callTool({
    name: 'arcgis_get_layer_details',
    arguments: { layer: 0 }
  });
  const detailsData = JSON.parse(detailsRes.content[0].text);
  console.log(`✓ Layer 0 has ${detailsData.fieldsCount} fields. Geometry: ${detailsData.geometryType}`);
  console.log(`  Fields sample: ${detailsData.fields.slice(0, 5).map(f => f.name).join(', ')}`);

  // Test 4: arcgis_search_substations
  console.log('\n[Test 4] Calling arcgis_search_substations (name: "MISSION", division: "San Francisco")...');
  const subRes = await client.callTool({
    name: 'arcgis_search_substations',
    arguments: { name: 'MISSION', division: 'San Francisco', limit: 3 }
  });
  const subData = JSON.parse(subRes.content[0].text);
  console.log(`✓ Found ${subData.count} matching substations:`);
  for (const f of subData.features) {
    console.log(`  - ${f.attributes.SubstationName} (ID: ${f.attributes.SubstationID}) | DG: ${f.attributes.Existing_DG} kW`);
  }

  // Test 5: arcgis_spatial_query
  console.log('\n[Test 5] Calling arcgis_spatial_query (near SF: lat 37.7749, lon -122.4194, radius 10km)...');
  const spatialRes = await client.callTool({
    name: 'arcgis_spatial_query',
    arguments: {
      layer: 'EDSubstations',
      longitude: -122.4194,
      latitude: 37.7749,
      distanceMeters: 10000,
      outFields: 'SubstationName,SubstationID,Voltage_kV,Division',
      resultRecordCount: 3
    }
  });
  const spatialData = JSON.parse(spatialRes.content[0].text);
  console.log(`✓ Found ${spatialData.count} substations within 10km radius:`);
  for (const f of spatialData.features) {
    console.log(`  - ${f.attributes.SubstationName} at coords:`, f.geometry);
  }

  // Test 6: arcgis_get_ica_capacity
  console.log('\n[Test 6] Calling arcgis_get_ica_capacity for feeder "022390402"...');
  const icaRes = await client.callTool({
    name: 'arcgis_get_ica_capacity',
    arguments: { feederId: '022390402', limit: 2 }
  });
  const icaData = JSON.parse(icaRes.content[0].text);
  console.log(`✓ ICA Status: ${icaData.icaStatus}, returned ${icaData.count} sections`);
  if (icaData.features?.length) {
    const s = icaData.features[0].attributes;
    console.log(`  - Section ${s.CSV_LineSection}: LoadCap=${s.LoadCapacity_kW} kW, GenCap=${s.GenCapacity_kW} kW, Screen=${s.ScreenL}`);
  }

  // Test 7: arcgis_get_load_profile
  console.log('\n[Test 7] Calling arcgis_get_load_profile for feeder "22390402"...');
  const profileRes = await client.callTool({
    name: 'arcgis_get_load_profile',
    arguments: {
      targetType: 'feeder',
      targetId: '22390402',
      month: '07'
    }
  });
  const profileData = JSON.parse(profileRes.content[0].text);
  console.log(`✓ Feeder July Load Profile: Peak High = ${profileData.summary.peakHigh} kW, Avg High = ${profileData.summary.avgHigh} kW (Hours: ${profileData.summary.count})`);

  // Test 8: arcgis_get_fire_threat_info
  console.log('\n[Test 8] Calling arcgis_get_fire_threat_info (Tier 2/3 count)...');
  const fireRes = await client.callTool({
    name: 'arcgis_get_fire_threat_info',
    arguments: { tier: 3, limit: 2 }
  });
  const fireData = JSON.parse(fireRes.content[0].text);
  console.log(`✓ HFTD Query: Found ${fireData.count} Tier 3 areas`);

  console.log('\n===========================================');
  console.log(' ALL MCP INTEGRATION TESTS PASSED PERFECTLY!');
  console.log('===========================================\n');

  await client.close();
  process.exit(0);
}

runMcpTests().catch(err => {
  console.error('\n❌ MCP Test failed:', err);
  process.exit(1);
});
