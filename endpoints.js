/* eslint-disable key-spacing */
module.exports = function DeveloperAPIEndpoints(baseUrl) {
  return {
    token:               `${baseUrl}/token`,
    datasetSNPs:         datasetId       => `${baseUrl}/datasets/${datasetId}/SNP`,
    createReportPage:    analysisId      => `${baseUrl}/analysis/${analysisId}/report-pages`,
    updateAnalysisState: analysisId      => `${baseUrl}/analysis/${analysisId}`,
    createAnalysis:      ()              => `${baseUrl}/analysis`,
    getAnalysis:         analysisId      => `${baseUrl}/analysis/${analysisId}`,
    createDataset:       ()              => `${baseUrl}/datasets`,
    createDatasetImport: datasetId       => `${baseUrl}/datasets/${datasetId}/import`,
    updateDatasetImport: datasetImportId => `${baseUrl}/datasetImports/${datasetImportId}`,
    datasetEthnicity:    datasetId       => `${baseUrl}/datasets/${datasetId}/ethnicity`,
    datasetFileUrls:     datasetId       => `${baseUrl}/datasets/${datasetId}/files`
  }
}
/* eslint-enable key-spacing */
