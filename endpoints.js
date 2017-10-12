
module.exports = function (baseUrl) {
    return {
        token: `${baseUrl}/token`,
        datasetSNPs: datasetId => `${baseUrl}/datasets/${datasetId}/SNP`,
        createReportPage: analysisId => `${baseUrl}/analysis/${analysisId}/report-pages`,
        updateAnalysisState: analysisId => `${baseUrl}/analysis/${analysisId}`,
        createAnalysis: () => `${baseUrl}/analysis`,
        createDataset: () => `${baseUrl}/datasets`,
        createDatasetImport: (datasetId) => `${baseUrl}/datasets/${datasetId}/import`,
        updateDatasetImport: (datasetImportId) => `${baseUrl}/datasetImports/${datasetImportId}`,
        datasetEthnicity: (datasetId) => `${baseUrl}/datasets/${datasetId}/ethnicity`
    };
};
