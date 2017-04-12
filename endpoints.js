
module.exports = function (baseUrl) {
    return {
        token: `${baseUrl}/token`,
        datasetSNPs: datasetId => `${baseUrl}/datasets/${datasetId}/SNP`,
        createReportPage: analysisId => `${baseUrl}/analysis/${analysisId}/report-pages`,
        updateAnalysisState: analysisId => `${baseUrl}/analysis/${analysisId}`
    };
};
